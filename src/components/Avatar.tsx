/**
 * A face, or the initials standing in for one. Square, like everything else
 * on nubid.co.
 */
export default function Avatar({
  name,
  url,
  size = 40,
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  if (url) {
    return (
      // Storage serves these straight from a public bucket; next/image would
      // want a remotePatterns entry per project and buys nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`shrink-0 border border-line object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={`flex shrink-0 items-center justify-center border border-line bg-rack-2 font-display font-semibold text-crew ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {initials || "?"}
    </span>
  );
}
