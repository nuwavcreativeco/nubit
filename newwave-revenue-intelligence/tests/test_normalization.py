from decimal import Decimal

import pytest

from newwave.money import MoneyParseError, format_cents, parse_amount, to_cents
from newwave.normalization.dates import parse_datetime
from newwave.normalization.identifiers import (
    detect_contact, normalize_cashtag, normalize_email, normalize_instagram, normalize_name, normalize_phone,
    normalize_venmo,
)


@pytest.mark.parametrize("text,expected", [
    ("$1,234.56", Decimal("1234.56")), ("-$20.00", Decimal("-20.00")), ("+ $50.00", Decimal("50.00")),
    ("- $12.50", Decimal("-12.50")), ("(45.00)", Decimal("-45.00")), ("100", Decimal("100")),
    ("0.1", Decimal("0.1")), ("25.00-", Decimal("-25.00")), ("$0", Decimal("0")),
])
def test_parse_amount(text, expected):
    assert parse_amount(text)[0] == expected


@pytest.mark.parametrize("bad", ["", "abc", "1.2.3", "$", "1,2", "12e5", None])
def test_parse_amount_rejects(bad):
    with pytest.raises(MoneyParseError):
        parse_amount(bad)


def test_decimal_cents_are_exact():
    # 0.1 + 0.2 style float errors must not happen
    total = sum(to_cents(parse_amount(x)[0]) for x in ["0.10", "0.20", "19.99", "0.01"])
    assert total == 2030
    assert format_cents(2030) == "$20.30"
    assert format_cents(-150) == "-$1.50"


@pytest.mark.parametrize("raw,norm", [
    ("(555) 010-0199", "+15550100199"), ("555.010.0199", "+15550100199"), ("+1 555 010 0199", "+15550100199"),
    ("15550100199", "+15550100199"), ("12345", None), ("", None), ("+44 20 7946 0958", "+442079460958"),
])
def test_phone(raw, norm):
    assert normalize_phone(raw) == norm


def test_handles_and_email():
    assert normalize_cashtag("$TestArtist") == "testartist"
    assert normalize_cashtag("https://cash.app/$TestArtist") == "testartist"
    assert normalize_instagram("@Test.Artist") == "test.artist"
    assert normalize_instagram("https://www.instagram.com/test.artist/") == "test.artist"
    assert normalize_venmo("@Test-Artist") == "test-artist"
    assert normalize_email(" Test@Example.COM ") == "test@example.com"
    assert normalize_email("not-an-email") is None
    assert normalize_instagram("bad handle with spaces") is None
    assert detect_contact("test@example.com") == ("email", "test@example.com")
    assert detect_contact("555-010-0199") == ("phone", "+15550100199")


def test_name_normalization():
    assert normalize_name("  José   O'Neil ") == "jose o neil"
    assert normalize_name("JOSE O NEIL") == "jose o neil"


@pytest.mark.parametrize("raw,iso", [
    ("2024-01-05 14:03:22 PST", "2024-01-05"), ("2024-01-05T14:03:22", "2024-01-05"), ("01/08/2024", "2024-01-08"),
    ("1/8/24", "2024-01-08"), ("Jan 8, 2024", "2024-01-08"), ("03/04/2024 2:03 PM", "2024-03-04"),
])
def test_dates(raw, iso):
    assert parse_datetime(raw)[0] == iso


def test_dates_dmy_and_invalid():
    assert parse_datetime("03/04/2024", "DMY")[0] == "2024-04-03"
    assert parse_datetime("not a date") == (None, None)
    assert parse_datetime("13/45/2024") == (None, None)
    assert parse_datetime("01/01/1890")[0] is None
