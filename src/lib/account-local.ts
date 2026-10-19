import { accountInvitationInput, type AccountDirectory, type AccountInvitationInput, type AccountInvitationResult } from './account-types';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const key = 'axolotl-account-preview:v1';
export const localAccountAdminId = '11111111-1111-4111-8111-111111111110';
const roles = [
  { id: 'editor', name: 'Editor', description: 'Create and edit newsroom posts.' },
  { id: 'publisher', name: 'Publisher', description: 'Edit, publish, and manage newsroom content.' },
  { id: 'administrator', name: 'Administrator', description: 'Manage content, agents, and newsroom accounts.' },
];

export class LocalAccountDirectory {
  constructor(private storage: Storage) {}
  list(): AccountDirectory {
    const raw = this.storage.getItem(key);
    if (raw) {
      try {
        const directory = JSON.parse(raw) as AccountDirectory;
        if (directory.identityAuthority !== 'local-preview' || !Array.isArray(directory.accounts) || !Array.isArray(directory.invitations)) throw new Error();
        return { ...directory, roles: structuredClone(roles) };
      } catch { throw new Error('Local account preview could not be read. Your newsroom drafts are unchanged.'); }
    }
    return { identityAuthority: 'local-preview', accounts: [{ id: localAccountAdminId, email: 'admin@example.invalid', name: 'Local preview administrator', status: 'active', roleIds: ['administrator'] }], invitations: [], roles: structuredClone(roles) };
  }
  invite(input: AccountInvitationInput): AccountInvitationResult {
    const directory = this.list(), clean = accountInvitationInput(input.email, input.name, input.roleIds, directory.roles);
    if (directory.accounts.some(account => account.email === clean.email)) throw new Error('This account already has newsroom access.');
    if (directory.invitations.some(invitation => invitation.email === clean.email && invitation.status === 'pending')) throw new Error('An invitation is already pending for this email address.');
    const invitation = { ...clean, id: crypto.randomUUID(), status: 'pending', expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
    this.storage.setItem(key, JSON.stringify({ ...directory, invitations: [invitation, ...directory.invitations] }));
    // Preview invitations cannot create a Core identity or send an email.
    return { invitation };
  }
  revoke(id: string): void {
    const directory = this.list(), invitation = directory.invitations.find(item => item.id === id);
    if (!invitation || invitation.status !== 'pending') throw new Error('This invitation is no longer pending. Reload accounts.');
    this.storage.setItem(key, JSON.stringify({ ...directory, invitations: directory.invitations.map(item => item.id === id ? { ...item, status: 'revoked' } : item) }));
  }
}
