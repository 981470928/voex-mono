import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { authUser } from '@/service/auth-session';
import { getTeams, type Team } from '@/service/api/team-api';
import { errorMessage } from '@/utils/error';

export const useTeamStore = defineStore('team', () => {
  const teams = ref<Team[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref('');
  const projectRevision = ref(0);
  const personalTeam = computed(() =>
    teams.value.find((team) => team.kind === 'personal' && team.owner_id === authUser.value?.id)
  );
  let request: Promise<Team[]> | undefined;
  let generation = 0;
  watch(
    () => authUser.value?.id,
    () => {
      generation++;
      teams.value = [];
      loaded.value = false;
      loading.value = false;
      request = undefined;
      error.value = '';
    }
  );
  function refresh() {
    if (request) return request;
    const current = generation;
    loading.value = true;
    error.value = '';
    request = getTeams()
      .then((result) => {
        if (current === generation) {
          teams.value = result;
          loaded.value = true;
        }
        return result;
      })
      .catch((cause) => {
        if (current === generation) error.value = errorMessage(cause, '团队加载失败');
        throw cause;
      })
      .finally(() => {
        if (current === generation) {
          loading.value = false;
          request = undefined;
        }
      });
    return request;
  }
  function ensure() {
    return loaded.value ? Promise.resolve(teams.value) : refresh();
  }
  function resolve(key?: string) {
    return key ? teams.value.find((team) => team.team_key === key) : personalTeam.value;
  }
  function invalidateProjects() {
    projectRevision.value++;
  }
  return {
    teams,
    personalTeam,
    loaded,
    loading,
    error,
    projectRevision,
    refresh,
    ensure,
    resolve,
    invalidateProjects,
  };
});
