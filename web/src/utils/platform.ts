export const isAndroid = /Android|Adr/.test(navigator.userAgent);
export const isiPhone = /iPhone/.test(navigator.userAgent);

export const isMobileBrowser = /Mobile/.test(navigator.userAgent);
export const isIpad =
  /iPad/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));

export const isAndroidHD = isAndroid && Math.min(window.screen.height, window.screen.width) >= 450;

export const isMobile = isMobileBrowser && !isAndroidHD && !isIpad;
