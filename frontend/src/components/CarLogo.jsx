/**
 * The app mark: a letter C opening to the right, with a car silhouette inside.
 * (PRD section 3 - "minimalist logo featuring the letter 'C' with a car inside".)
 *
 * Inline SVG rather than the previous <img src="/car-logo.png"> with an
 * onError handler that rewrote parentElement.innerHTML - that pattern destroys
 * React's control of the subtree, and it meant the brand silently degraded to a
 * bare letter whenever the PNG was missing. This scales, needs no request, and
 * adapts to the theme.
 */
export default function CarLogo({ className = 'w-10 h-10', title = 'רכב משפחתי' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="carlogo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0A84FF" />
          <stop offset="100%" stopColor="#0047AB" />
        </linearGradient>
      </defs>

      {/* Rounded-square app tile, iOS style */}
      <rect width="64" height="64" rx="16" fill="url(#carlogo-bg)" />

      {/* The C: an arc left open on the right-hand side */}
      <path
        d="M45 19.5a18.5 18.5 0 1 0 0 25"
        stroke="white"
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* Car silhouette nested in the counter of the C */}
      <g transform="translate(20.5 27.5)">
        {/* body + cabin */}
        <path
          d="M1.2 6.6 3 2.9A2.6 2.6 0 0 1 5.35 1.4h7.3A2.6 2.6 0 0 1 15 2.9l1.8 3.7"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="0" y="6.2" width="18" height="6.1" rx="2.1" fill="white" />
        {/* wheels, knocked out of the body so they read at small sizes */}
        <circle cx="4.3" cy="13.1" r="2.15" fill="white" />
        <circle cx="13.7" cy="13.1" r="2.15" fill="white" />
        <circle cx="4.3" cy="13.1" r="0.85" fill="#0A5BC4" />
        <circle cx="13.7" cy="13.1" r="0.85" fill="#0A5BC4" />
      </g>
    </svg>
  );
}
