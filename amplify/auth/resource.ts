import { defineAuth } from '@aws-amplify/backend';

/** Accounts are invited by the parent through Cognito, then added to Editors. */
export const auth = defineAuth({
  loginWith: { email: true },
  groups: ['Editors'],
});
