import type { TowerId } from '../core/types';

/** Inline SVG glyphs for the build palette, drawn in each tower's colour. */
export const TOWER_ICONS: Record<TowerId, string> = {
  sniper: `<svg viewBox="0 0 40 40"><rect x="17" y="30" width="6" height="6" fill="#6c6e68"/><rect x="18" y="20" width="4" height="10" fill="#1b2a34"/><rect x="14" y="16" width="12" height="6" rx="2" fill="#1b2a34"/><rect x="16" y="10" width="8" height="4" fill="#b6d7e8"/><rect x="24" y="16" width="14" height="3" fill="#1b2a34"/></svg>`,
  cluster: `<svg viewBox="0 0 40 40"><rect x="13" y="30" width="14" height="6" rx="2" fill="#6c6e68"/><rect x="14" y="18" width="12" height="12" rx="2" fill="#a5e9ff"/><rect x="9" y="8" width="6" height="12" rx="3" fill="#a5e9ff" transform="rotate(-14 12 14)"/><rect x="17" y="5" width="6" height="13" rx="3" fill="#f4f4f4"/><rect x="25" y="8" width="6" height="12" rx="3" fill="#a5e9ff" transform="rotate(14 28 14)"/></svg>`,
  support: `<svg viewBox="0 0 40 40"><rect x="16" y="26" width="8" height="10" fill="#6c6e68"/><circle cx="20" cy="20" r="7" fill="#f2cd37"/><circle cx="20" cy="20" r="3" fill="#fff"/><rect x="19" y="4" width="2" height="8" fill="#f4f4f4"/><rect x="6" y="18" width="28" height="2" fill="#f2cd37" opacity="0.55"/></svg>`,
  shooter: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="13" y="22" width="22" height="8" fill="#f4f4f4"/>
    <circle cx="24" cy="16" r="7" fill="#d0011b"/>
    <rect x="27" y="13" width="16" height="5" fill="#212121"/>
    <rect x="20" y="9" width="8" height="3" fill="#ffcf00"/>
    <circle cx="14" cy="31.5" r="1.6" fill="#212121"/><circle cx="34" cy="31.5" r="1.6" fill="#212121"/>
  </svg>`,
  mortar: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="30" width="36" height="8" fill="#6c6e68"/>
    <rect x="12" y="24" width="24" height="6" fill="#0a3463"/>
    <g transform="rotate(-32 24 18)">
      <rect x="14" y="12" width="20" height="10" rx="4" fill="#0a3463"/>
      <rect x="30" y="9" width="7" height="16" rx="2" fill="#212121"/>
    </g>
    <rect x="10" y="20" width="8" height="6" fill="#d0011b"/>
    <circle cx="14" cy="31.5" r="1.6" fill="#212121"/><circle cx="34" cy="31.5" r="1.6" fill="#212121"/>
  </svg>`,
  freezer: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="13" y="24" width="22" height="6" fill="#f4f4f4"/>
    <path d="M13 24a11 11 0 0 1 22 0z" fill="#a5e9ff" opacity="0.75"/>
    <rect x="21" y="8" width="6" height="10" fill="#5c94fc"/>
    <g stroke="#5c94fc" stroke-width="2.6" stroke-linecap="round">
      <path d="M24 2v6M24 18v5M14.5 6l4 4M29.5 14l4 4M33.5 6l-4 4M18.5 14l-4 4"/>
    </g>
  </svg>`,
  coil: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="17" y="24" width="14" height="4" fill="#f4f4f4"/>
    <rect x="19" y="20" width="10" height="4" fill="#f4f4f4"/>
    <rect x="22" y="16" width="5" height="4" fill="#1b2a34"/>
    <circle cx="24" cy="10" r="6" fill="#ffcf00"/>
    <ellipse cx="24" cy="10" rx="9" ry="2.6" fill="none" stroke="#ffcf00" stroke-width="2"/>
    <path d="M31 6l4-4M32 12l5 2M36 9l4 1" stroke="#ffcf00" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  sprayer: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="13" y="26" width="22" height="4" fill="#184632"/>
    <rect x="16" y="16" width="16" height="10" rx="3" fill="#4b9f4a"/>
    <rect x="16" y="19" width="16" height="2.4" fill="#212121"/>
    <rect x="30" y="18" width="9" height="4" rx="1.5" fill="#212121"/>
    <g fill="#4b9f4a" opacity="0.75">
      <circle cx="42" cy="14" r="2.4"/><circle cx="45" cy="19" r="1.8"/><circle cx="41" cy="23" r="1.6"/>
    </g>
    <circle cx="14" cy="31.5" r="1.6" fill="#212121"/><circle cx="34" cy="31.5" r="1.6" fill="#212121"/>
  </svg>`,
  acid: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="14" y="19" width="20" height="11" rx="3" fill="#184632"/>
    <rect x="14" y="22" width="20" height="2.4" fill="#212121"/>
    <rect x="17" y="11" width="14" height="8" rx="3" fill="#4b9f4a"/>
    <g transform="rotate(-32 30 12)"><rect x="30" y="7" width="11" height="7" rx="3" fill="#4b9f4a"/></g>
    <g fill="#4b9f4a" opacity="0.8">
      <circle cx="41" cy="5" r="2.6"/><circle cx="44" cy="10" r="1.8"/><circle cx="40" cy="13" r="1.5"/>
    </g>
    <circle cx="14" cy="31.5" r="1.6" fill="#212121"/><circle cx="34" cy="31.5" r="1.6" fill="#212121"/>
  </svg>`,
  rail: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="18" y="22" width="12" height="8" fill="#1b2a34"/>
    <rect x="11" y="14" width="27" height="6" rx="2" fill="#1b2a34"/>
    <rect x="11" y="24" width="27" height="3" fill="#ffcf00"/>
    <rect x="36" y="13" width="10" height="3" fill="#ffcf00"/>
    <rect x="36" y="20" width="10" height="3" fill="#ffcf00"/>
    <circle cx="20" cy="17" r="3.2" fill="#ffcf00"/>
    <circle cx="14" cy="31.5" r="1.6" fill="#212121"/><circle cx="34" cy="31.5" r="1.6" fill="#212121"/>
  </svg>`,
  buckshot: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="12" y="23" width="24" height="7" rx="2" fill="#fe8a18"/>
    <rect x="14" y="12" width="5" height="12" rx="2" fill="#212121"/>
    <rect x="21" y="10" width="5" height="14" rx="2" fill="#212121"/>
    <rect x="28" y="12" width="5" height="12" rx="2" fill="#212121"/>
    <rect x="30" y="24" width="12" height="5" rx="2" fill="#582a12"/>
    <circle cx="14" cy="31.5" r="1.6" fill="#212121"/><circle cx="34" cy="31.5" r="1.6" fill="#212121"/>
  </svg>`,
  glacier: `<svg viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="30" width="32" height="8" fill="#6c6e68"/>
    <rect x="14" y="26" width="20" height="4" fill="#f4f4f4"/>
    <path d="M24 3l9 23H15z" fill="#a5e9ff" opacity="0.85"/>
    <path d="M24 3l4 23h-8z" fill="#f4f4f4" opacity="0.7"/>
    <circle cx="24" cy="15" r="4" fill="#5c94fc"/>
    <g stroke="#5c94fc" stroke-width="2" stroke-linecap="round">
      <path d="M24 1v4M9 8l5 3M39 8l-5 3"/>
    </g>
  </svg>`,
};

export const ENEMY_ICONS: Record<string, string> = {
  slime: `<svg viewBox="0 0 40 40"><path d="M4 30a16 14 0 0 1 32 0z" fill="#4b9f4a"/><path d="M8 30a12 11 0 0 1 24 0z" fill="#184632" opacity="0.6"/><circle cx="15" cy="22" r="3.4" fill="#fff"/><circle cx="25" cy="22" r="3.4" fill="#fff"/><circle cx="15" cy="22.5" r="1.6" fill="#000"/><circle cx="25" cy="22.5" r="1.6" fill="#000"/></svg>`,
  skeleton: `<svg viewBox="0 0 40 40"><rect x="13" y="6" width="14" height="12" rx="4" fill="#f4f4f4"/><circle cx="17" cy="12" r="2.6" fill="#000"/><circle cx="23" cy="12" r="2.6" fill="#000"/><rect x="12" y="19" width="16" height="12" fill="#f4f4f4"/><g fill="#7f7f7f"><rect x="12" y="21" width="16" height="1.8"/><rect x="12" y="25" width="16" height="1.8"/><rect x="12" y="29" width="16" height="1.8"/></g><rect x="13" y="31" width="4" height="6" fill="#f4f4f4"/><rect x="23" y="31" width="4" height="6" fill="#f4f4f4"/></svg>`,
  zombie: `<svg viewBox="0 0 40 40"><rect x="13" y="5" width="15" height="12" rx="3" fill="#184632"/><circle cx="17.5" cy="11" r="2.6" fill="#d0011b"/><circle cx="24" cy="11" r="2.6" fill="#d0011b"/><rect x="11" y="18" width="18" height="14" fill="#184632"/><rect x="11" y="21" width="18" height="4" fill="#582a12"/><rect x="6" y="19" width="6" height="4" rx="2" fill="#237841"/><rect x="29" y="19" width="6" height="4" rx="2" fill="#237841"/><rect x="13" y="32" width="5" height="6" fill="#582a12"/><rect x="22" y="32" width="5" height="6" fill="#582a12"/></svg>`,
  ghost: `<svg viewBox="0 0 40 40"><path d="M8 34V18a12 12 0 0 1 24 0v16l-4-4-4 4-4-4-4 4-4-4z" fill="#b6d7e8" opacity="0.75"/><ellipse cx="16" cy="18" rx="2.6" ry="3.4" fill="#1b2a34"/><ellipse cx="24" cy="18" rx="2.6" ry="3.4" fill="#1b2a34"/><ellipse cx="20" cy="25" rx="3" ry="2.2" fill="#1b2a34" opacity="0.7"/></svg>`,
  demon: `<svg viewBox="0 0 40 40"><path d="M11 8l3 6h-4z" fill="#212121"/><path d="M29 8l-3 6h4z" fill="#212121"/><rect x="12" y="6" width="16" height="13" rx="3" fill="#c4281c"/><circle cx="16.5" cy="12" r="2.6" fill="#f2cd37"/><circle cx="23.5" cy="12" r="2.6" fill="#f2cd37"/><rect x="9" y="19" width="22" height="14" fill="#c4281c"/><rect x="15" y="22" width="10" height="6" fill="#212121"/><path d="M9 20L2 12l3 9z" fill="#212121"/><path d="M31 20l7-8-3 9z" fill="#212121"/><rect x="12" y="33" width="6" height="6" fill="#212121"/><rect x="22" y="33" width="6" height="6" fill="#212121"/></svg>`,
  overlord: `<svg viewBox="0 0 40 40"><g fill="#f2cd37"><path d="M9 4l3 6H9z"/><path d="M17 2l3 7h-3z"/><path d="M25 4l2 6h-3z"/></g><rect x="9" y="10" width="22" height="12" rx="3" fill="#212121"/><circle cx="15" cy="16" r="3" fill="#923978"/><circle cx="25" cy="16" r="3" fill="#923978"/><rect x="7" y="22" width="26" height="12" fill="#923978"/><circle cx="20" cy="27" r="4" fill="#f2cd37"/><rect x="8" y="34" width="7" height="5" fill="#212121"/><rect x="25" y="34" width="7" height="5" fill="#212121"/></svg>`,
  archer: `<svg viewBox="0 0 40 40"><rect x="13" y="7" width="14" height="11" rx="3" fill="#2f6d3f"/><circle cx="17.5" cy="12.5" r="2.4" fill="#d9c07a"/><circle cx="22.5" cy="12.5" r="2.4" fill="#d9c07a"/><rect x="11" y="18" width="18" height="13" fill="#2f6d3f"/><rect x="11" y="21" width="18" height="3.5" fill="#245530"/><rect x="24" y="14" width="2.6" height="18" fill="#8a6a3a" transform="rotate(18 25 23)"/><path d="M35 12l-8 3.4 8 3.4z" fill="#d9c07a"/><path d="M29 15.4h6M29 15.4l-2.6-2.2M29 15.4l-2.6 2.2" stroke="#d9c07a" stroke-width="1.3" fill="none"/></svg>`,
  gunner: `<svg viewBox="0 0 40 40"><rect x="13" y="7" width="14" height="11" rx="3" fill="#35404d"/><circle cx="17.5" cy="12.5" r="2.4" fill="#b8862f"/><circle cx="22.5" cy="12.5" r="2.4" fill="#b8862f"/><rect x="11" y="18" width="18" height="13" fill="#35404d"/><rect x="11" y="21" width="18" height="3.5" fill="#242c36"/><rect x="27" y="15" width="11" height="5" rx="1.6" fill="#4d5a6b"/><rect x="35" y="16.2" width="4" height="2.6" fill="#b8862f"/><rect x="13" y="31" width="5" height="6" fill="#242c36"/><rect x="22" y="31" width="5" height="6" fill="#242c36"/></svg>`,
  brute: `<svg viewBox="0 0 40 40"><rect x="12" y="5" width="16" height="11" rx="2" fill="#6c6e68"/><rect x="15" y="8" width="10" height="3" fill="#212121"/><rect x="8" y="16" width="24" height="15" rx="2" fill="#6c6e68"/><rect x="11" y="19" width="18" height="4" fill="#a0a5a9"/><rect x="4" y="16" width="5" height="10" rx="2" fill="#7f7f7f"/><rect x="31" y="16" width="5" height="10" rx="2" fill="#7f7f7f"/><rect x="12" y="31" width="6" height="6" fill="#6c6e68"/><rect x="22" y="31" width="6" height="6" fill="#6c6e68"/></svg>`,
  wisp: `<svg viewBox="0 0 40 40"><circle cx="20" cy="18" r="11" fill="#b6d7e8" opacity="0.8"/><circle cx="20" cy="18" r="6" fill="#f4f4f4" opacity="0.8"/><g stroke="#5c94fc" stroke-width="2" stroke-linecap="round"><path d="M20 3v5M6 10l4 3M34 10l-4 3M8 26l4-2M32 26l-4-2"/></g><circle cx="16.5" cy="17" r="2" fill="#1b2a34"/><circle cx="23.5" cy="17" r="2" fill="#1b2a34"/></svg>`,
  golem: `<svg viewBox="0 0 40 40"><rect x="11" y="6" width="18" height="10" rx="3" fill="#6c6e68"/><circle cx="16" cy="11" r="2.2" fill="#ffcf00"/><circle cx="24" cy="11" r="2.2" fill="#ffcf00"/><rect x="7" y="17" width="26" height="14" rx="2" fill="#7f7f7f"/><path d="M11 20h18v2H11zM11 25h18v2H11z" fill="#6c6e68"/><rect x="3" y="18" width="5" height="9" rx="2" fill="#a0a5a9"/><rect x="32" y="18" width="5" height="9" rx="2" fill="#a0a5a9"/><rect x="10" y="31" width="8" height="6" fill="#6c6e68"/><rect x="22" y="31" width="8" height="6" fill="#6c6e68"/></svg>`,
  catapult: `<svg viewBox="0 0 40 40"><rect x="6" y="24" width="28" height="8" rx="2" fill="#582a12"/><circle cx="11" cy="33" r="4" fill="#212121"/><circle cx="29" cy="33" r="4" fill="#212121"/><rect x="18" y="9" width="4" height="17" fill="#6c6e68" transform="rotate(-30 20 17)"/><circle cx="11" cy="10" r="4.4" fill="#7f7f7f"/><rect x="12" y="15" width="11" height="6" rx="2" fill="#a0a5a9"/></svg>`,
};