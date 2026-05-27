import { inject } from '@angular/core';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { from, pipe, switchMap, tap } from 'rxjs';
import { MatchService } from '../match/match.service';
import { CreateMatchRequest, Match, MatchError } from '../match/match.types';

type LobbyState = {
  matches: Match[];
  loading: boolean;
  error: MatchError | null;
  createError: MatchError | null;
};

const initial: LobbyState = {
  matches: [],
  loading: false,
  error: null,
  createError: null,
};

export const LobbyStore = signalStore(
  { providedIn: 'root' },
  withState<LobbyState>(initial),
  withMethods((store, svc = inject(MatchService)) => ({
    load: rxMethod<void>(pipe(
      tap(() => patchState(store, { loading: true, error: null })),
      switchMap(() => from(svc.list()).pipe(
        tapResponse({
          next: r => {
            if (r.ok) {
              patchState(store, { matches: r.value, loading: false });
            } else {
              patchState(store, { loading: false, error: r.error });
            }
          },
          error: (e: MatchError) => patchState(store, { loading: false, error: e }),
        })
      ))
    )),
    create: rxMethod<CreateMatchRequest>(pipe(
      switchMap(req => from(svc.create(req)).pipe(
        switchMap(r => {
          if (!r.ok) {
            patchState(store, { createError: r.error });
            return [];
          }
          // Success: clear createError, then refresh the list
          patchState(store, { createError: null });
          return from(svc.list()).pipe(
            tapResponse({
              next: listResult => {
                if (listResult.ok) {
                  patchState(store, { matches: listResult.value });
                }
              },
              error: () => { /* ignore list-refresh errors */ },
            })
          );
        })
      ))
    )),
  })),
  withHooks({
    onInit(store) { store.load(); },
  })
);
