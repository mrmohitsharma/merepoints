/**
 * Company details shown on the website, Terms, Privacy and Refund pages.
 * Same company as the Go Live project. Values marked "[…]" are not in the Go Live repo
 * (they are set there only as server env vars) and must be filled in before launch.
 */
export const COMPANY = {
  brand: 'Mere Points',
  legalName: '[Company legal name]',
  address: '[Registered office address]',
  supportEmail: 'support@icca.co.in',
  phone: null as string | null,
  grievanceOfficer: '[Grievance Officer name]',
  jurisdiction: 'Gurugram, Haryana',
  domain: 'merepoints.in',
  updated: '19 November 2026',
  playStoreUrl: null as string | null,
  appStoreUrl: null as string | null,
};

/** True while any required legal detail is still a placeholder. */
export const companyIncomplete = [COMPANY.legalName, COMPANY.address, COMPANY.grievanceOfficer].some((v) => v.startsWith('['));
