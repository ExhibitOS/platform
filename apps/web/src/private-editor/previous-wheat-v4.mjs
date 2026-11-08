// SPDX-License-Identifier: AGPL-3.0-or-later
// The exact public Wheat publication that preceded the Hayes addition.
// This is not an admission of arbitrary archived v4 publications.
export const PREVIOUS_WHEAT_V4_INDEX = '8de1650dfcb0e43aafae1f8c181293a0a88fe18c58acd2389c32de0c7bde91a1';
// The immediately preceding public Wheat + Hayes v4 is also retained when
// publishing its compact-model successor. These are exact content hashes only.
export const PREVIOUS_HAYES_WHEAT_V4_INDEX = '8f58935dd614adbfa231b083552c1af188fc8ce10984fdddf97d7b9f716718a2';
export const isSupportedPreviousWheatV4 = index => index === PREVIOUS_WHEAT_V4_INDEX || index === PREVIOUS_HAYES_WHEAT_V4_INDEX;
