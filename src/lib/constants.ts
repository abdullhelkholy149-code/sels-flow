/** Global, non negotiable conventions (Section 3 of the specification). */

export const CURRENCY = 'EGP';

/** Arabic (Egypt) with Western digits and Gregorian calendar, per decision D-008 (locale and digits). */
export const DEFAULT_NUMBER_LOCALE = 'ar-EG-u-nu-latn-ca-gregory';

export const DISPLAY_TIME_ZONE = 'Africa/Cairo';

export const STORAGE_TIME_ZONE = 'UTC';

export const DEFAULT_VAT_RATE_PERCENT = '14';

/** Quantity scale: NUMERIC(14,3). */
export const QUANTITY_DECIMAL_PLACES = 3;

/** Money scale: NUMERIC(14,2), rounded half up per invoice line. */
export const MONEY_DECIMAL_PLACES = 2;

export const APP_NAME = 'SalesFlow';

export const SUPPORT_EMAIL = 'support@example.com';
