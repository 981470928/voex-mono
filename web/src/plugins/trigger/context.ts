import type { InjectionKey, Ref } from 'vue';

export interface TriggerContext {
  register: (element: Ref<HTMLElement | undefined>) => void;
  unregister: (element: Ref<HTMLElement | undefined>) => void;
  enter: () => void;
  leave: () => void;
  depth: number;
}

export const triggerContextKey: InjectionKey<TriggerContext> = Symbol('VoexTrigger');
