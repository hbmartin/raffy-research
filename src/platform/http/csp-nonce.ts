const CSP_NONCE_META_SELECTOR = 'meta[property="csp-nonce"]';
const CSP_NONCE_GLOBAL_KEY = '__nonce__';
const CSP_NONCE_BRIDGE_INSTALLED_KEY = '__startUiCspNonceBridgeInstalled';
declare global {
  interface Window {
    __nonce__?: string;
    __startUiCspNonceBridgeInstalled?: boolean;
  }
}

export const createCspNonceBridgeScript = (nonce: string) => `
(function(nonceKey, installedKey, nonce) {
  var win = window;
  win[nonceKey] = nonce;
  if (win[installedKey]) return;
  win[installedKey] = true;
  if (typeof Document === "undefined") return;

  var prototype = Document.prototype;
  var createElement = prototype.createElement;
  prototype.createElement = function(tagName, options) {
    var element = createElement.call(this, tagName, options);
    if (
      typeof tagName === "string" &&
      tagName.toLowerCase() === "style" &&
      !element.getAttribute("nonce")
    ) {
      element.setAttribute("nonce", win[nonceKey] || nonce);
    }
    return element;
  };
})(${JSON.stringify(CSP_NONCE_GLOBAL_KEY)}, ${JSON.stringify(
  CSP_NONCE_BRIDGE_INSTALLED_KEY
)}, ${JSON.stringify(nonce)});
`;

export function readCspNonceFromMeta() {
  if (typeof document === 'undefined') return undefined;

  const element = document.querySelector(CSP_NONCE_META_SELECTOR);
  if (!element) return undefined;

  return (
    element.getAttribute('content') ||
    (isElementWithNonceProperty(element) ? element.nonce : undefined) ||
    element.getAttribute('nonce') ||
    undefined
  );
}

function isElementWithNonceProperty(
  element: Element
): element is Element & { nonce: string } {
  return 'nonce' in element && typeof element.nonce === 'string';
}
