import { createRouter, createWebHistory } from 'vue-router';
import {
  authenticated,
  accessExpiresAt,
  authUser,
  sessionExpired,
  sessionInitialized,
} from '@/service/auth-session';
import { refreshSession } from '@/service/api/https';
import { safeReturnPath } from '@/utils/auth';

const base = import.meta.env.BASE_URL;

const router = createRouter({
  history: createWebHistory(base),
  routes: [
    {
      path: '/login',
      name: 'login',
      meta: { anonymous: true },
      component: () => import('@/views/auth/LoginPage.vue'),
    },
    {
      path: '/register',
      name: 'register',
      meta: { anonymous: true },
      component: () => import('@/views/auth/RegisterPage.vue'),
    },
    { path: '/join', name: 'join', component: () => import('@/views/team/JoinTeamPage.vue') },
    {
      path: '/share',
      name: 'share',
      meta: { public: true },
      component: () => import('@/views/share/SharedFilePage.vue'),
    },
    {
      path: '/',
      redirect: '/home/recent',
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/views/home/Home.vue'),
      children: [
        {
          path: '',
          redirect: { name: 'recent' },
        },
        {
          path: 'profile',
          name: 'profile',
          component: () => import('@/views/auth/ProfilePage.vue'),
        },
        { path: 'teams', name: 'teams', component: () => import('@/views/team/TeamPage.vue') },
        { path: 'trash', name: 'trash', component: () => import('@/views/home/TrashPage.vue') },
        {
          path: 'project/:projectId/:folderId?',
          name: 'project',
          component: () => import('@/views/home/ProjectPage.vue'),
        },
        {
          path: 'recent',
          name: 'recent',
          component: () => import('@/views/home/RecentPage.vue'),
        },
      ],
    },
    {
      path: '/recent/:file_key',
      name: 'recent-file',
      component: () => import('@/views/share/SharedFilePage.vue'),
    },
    {
      path: '/edit/:file_key',
      name: 'edit',
      component: () => import('@/views/edit/EditPage.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/home/recent' },
  ],
});

router.beforeEach(async (to, from) => {
  // Resolve old share editor URLs once, then use the account's document permissions.
  if (to.name === 'edit' && to.query.access === 'share' && to.hash) {
    return { name: 'share', hash: to.hash, replace: true };
  }
  if (to.name === 'edit' && (to.query.access === 'share' || to.query.access === 'recent')) {
    return { name: 'edit', params: to.params, replace: true };
  }
  if (
    to.meta.anonymous &&
    from.meta.anonymous &&
    from.hash &&
    !to.hash &&
    (to.query.return === '/join' || to.query.return === '/share')
  ) {
    return { path: to.path, query: to.query, hash: from.hash, replace: true };
  }
  // Invitation and share credentials stay in fragments throughout authentication.
  if (
    (to.name === 'join' || (to.name === 'share' && from.query.return === '/share')) &&
    !to.hash &&
    from.meta.anonymous &&
    from.hash
  ) {
    return { name: to.name, hash: from.hash, replace: true };
  }
  if (to.meta.public) return true;
  if (
    !sessionInitialized.value ||
    (authenticated.value && accessExpiresAt.value < Date.now() + 30000)
  ) {
    try {
      await refreshSession();
    } catch {
      /* The login form remains available while offline. */
    }
  }
  if (to.meta.anonymous) {
    if (!authenticated.value) return true;
    const destination = safeReturnPath(to.query.return);
    return (destination === '/join' || destination === '/share') && to.hash
      ? { path: destination, hash: to.hash }
      : destination;
  }
  if (authenticated.value) return true;
  // Re-authenticate over the existing screen so unsaved document contents stay mounted.
  if (authUser.value && sessionExpired.value) return false;
  return {
    name: 'login',
    query: { return: to.name === 'join' ? '/join' : to.fullPath },
    hash: to.name === 'join' ? to.hash : undefined,
    replace: true,
  };
});

export default router;
