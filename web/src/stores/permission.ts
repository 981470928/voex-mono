import { defineStore } from 'pinia';
import type { DocumentPermissions } from '@/service/api/document-api';

type PermissionSource = { permissions?: Partial<DocumentPermissions> };
type FileAccess = 'project' | 'share' | 'unavailable';

export interface ResourcePermissions extends DocumentPermissions {
  rename: boolean;
  remove: boolean;
  details: boolean;
  directory: boolean;
}

export const usePermissionStore = defineStore('permission', () => {
  // Read the latest server DTO reactively. A second permission cache could retain
  // grants after a refresh, account change, or revoked share.
  function resolve(
    source: PermissionSource | null | undefined,
    projectAccess: boolean
  ): ResourcePermissions {
    const read = source?.permissions?.read === true;
    const write = read && source?.permissions?.write === true;
    return {
      read,
      write,
      manage: read && source?.permissions?.manage === true,
      share: read && source?.permissions?.share === true,
      rename: projectAccess && write,
      remove: read && source?.permissions?.remove === true,
      details: read,
      directory: projectAccess && read,
    };
  }

  function project(source?: PermissionSource | null) {
    return resolve(source, true);
  }

  // Folders always inherit project permissions; files may carry an explicit DTO.
  function folder(source?: PermissionSource | null) {
    return resolve(
      {
        permissions: {
          ...source?.permissions,
          remove: source?.permissions?.children_remove === true,
        },
      },
      true
    );
  }

  function document(source?: PermissionSource | null, parent?: PermissionSource | null) {
    return resolve(source?.permissions ? source : source ? parent : null, true);
  }

  function recent(source?: (PermissionSource & { access: FileAccess }) | null) {
    return {
      ...resolve(source?.access === 'unavailable' ? null : source, source?.access === 'project'),
      // Removing one's history never requires permission to modify the file.
      removeRecord: !!source,
    };
  }

  function shared(source?: PermissionSource | null) {
    return resolve(source, false);
  }

  return { project, folder, document, recent, shared };
});
