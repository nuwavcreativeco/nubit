export type Coords = { lat: number; lng: number };
export type SearchArea = Coords & { radiusMi: number };

export const DEFAULT_RADIUS_MI = 25;
export const MIN_RADIUS_MI = 1;
export const MAX_RADIUS_MI = 100;

/** Where an anonymous visitor's search area lives — signed-in users get a profile column. */
export const AREA_STORAGE_KEY = "nubid:area";

export function readStoredArea(): SearchArea | null {
  try {
    const raw = window.localStorage.getItem(AREA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SearchArea>;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      radiusMi:
        typeof parsed.radiusMi === "number" ? parsed.radiusMi : DEFAULT_RADIUS_MI,
    };
  } catch {
    // Private mode, blocked storage, corrupt JSON — no saved area is fine.
    return null;
  }
}

export function storeArea(area: SearchArea | null) {
  try {
    if (area === null) window.localStorage.removeItem(AREA_STORAGE_KEY);
    else window.localStorage.setItem(AREA_STORAGE_KEY, JSON.stringify(area));
  } catch {
    // Not being able to remember the area is not worth failing the click over.
  }
}

/** Wraps the callback-style geolocation API, with errors people can act on. */
export function getCurrentCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser can't share a location."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(
              new Error(
                "Location is blocked for this site. Turn it on in your browser's site settings and try again."
              )
            );
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error("Couldn't get a fix on your location. Try again in a moment."));
            break;
          case error.TIMEOUT:
            reject(new Error("Locating took too long. Try again."));
            break;
          default:
            reject(new Error("Couldn't read your location."));
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  });
}
