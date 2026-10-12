import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';

export const backend = defineBackend({ auth, data, storage });

// Hiding a sign-up button alone cannot disable Cognito's public SignUp API.
// This CloudFormation setting enforces invitation-only accounts in AWS.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyOverride(
  'AdminCreateUserConfig.AllowAdminCreateUserOnly',
  true,
);
