import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

const schema = a.schema({
  // The workspace is private even when a draft has previously been published.
  // Publishing copies a snapshot into PublishedPost; a status filter is not an
  // authorization boundary and is deliberately not used for public access.
  Post: a
    .model({
      id: a.id().required(),
      title: a.string().required(),
      slug: a.string().required(),
      excerpt: a.string().required(),
      category: a.string().required(),
      document: a.string().required(),
      coverKey: a.string(),
      status: a.string().required(),
      publishedAt: a.datetime(),
    })
    .authorization((allow) => [allow.groups(['Editors'])]),

  // A separate public projection keeps draft text and draft asset keys private.
  // The client reuses Post.id so an edit updates one published snapshot.
  PublishedPost: a
    .model({
      id: a.id().required(),
      title: a.string().required(),
      slug: a.string().required(),
      excerpt: a.string().required(),
      category: a.string().required(),
      document: a.string().required(),
      coverKey: a.string(),
      publishedAt: a.datetime().required(),
    })
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated('identityPool').to(['read']),
      allow.authenticated().to(['read']),
      allow.groups(['Editors']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // AWS names this backend mode IAM; Amplify's browser client names it
    // identityPool. Guest access uses temporary Cognito credentials, no API key.
    defaultAuthorizationMode: 'iam',
  },
});
