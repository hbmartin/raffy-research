export const getPageTitle = (pageTitle?: string, titlePrefix = '') => {
  const prefix = titlePrefix ? `${titlePrefix} ` : '';
  return pageTitle
    ? `${prefix}${pageTitle} | Raffy Research`
    : `${prefix}Raffy Research`;
};
