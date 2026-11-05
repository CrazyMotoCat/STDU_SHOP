import { useCallback, useEffect, useRef, useState } from 'react';
import { readPage } from './api';
import { mergeReferences } from './model';

type PageState<T> = {
  path: string | null;
  items: T[];
  cursor: string | null;
  loading: boolean;
  error: string;
  windowed: boolean;
};

function empty<T>(path: string | null): PageState<T> {
  return {
    path,
    items: [],
    cursor: null,
    loading: Boolean(path),
    error: '',
    windowed: false,
  };
}

export function useReferencePages<T extends { id: string; version: number }>(
  path: string | null,
) {
  const [state, setState] = useState(() => empty<T>(path));
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (target: string, cursor: string | null) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((previous) => ({
      ...(previous.path === target ? previous : empty<T>(target)),
      loading: true,
      error: '',
    }));
    try {
      const page = await readPage<T>(target, cursor, controller.signal);
      if (controller.signal.aborted) return;
      setState((previous) => ({
        path: target,
        items: mergeReferences(cursor ? previous.items : [], page.data),
        cursor: page.meta.nextCursor,
        loading: false,
        error: '',
        windowed: Boolean(cursor),
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить записи.',
      }));
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, []);

  useEffect(() => {
    if (path) void load(path, null);
    return () => active.current?.abort();
  }, [path, load]);

  const current = state.path === path ? state : empty<T>(path);
  return {
    ...current,
    more() {
      if (path && !active.current) void load(path, current.cursor);
    },
    restart() {
      if (path) {
        setState(empty<T>(path));
        void load(path, null);
      }
    },
    upsert(item: T) {
      active.current?.abort();
      active.current = null;
      setState((previous) => ({
        ...(previous.path === path ? previous : empty<T>(path)),
        loading: false,
        error: '',
        items: mergeReferences(previous.path === path ? previous.items : [], [
          item,
        ]),
      }));
    },
  };
}
