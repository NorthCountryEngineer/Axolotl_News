import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'axolotlNewsMedia',
  access: (allow) => ({
    'drafts/*': [allow.groups(['Editors']).to(['read', 'write', 'delete'])],
    'published/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      // Members use their group IAM role, so grant this explicitly as well.
      allow.groups(['Editors']).to(['read', 'write', 'delete']),
    ],
  }),
});
