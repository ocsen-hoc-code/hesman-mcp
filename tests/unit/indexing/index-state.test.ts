import { describe, it, expect } from 'vitest';
import { IndexState } from '../../../src/indexing/index-state.js';

describe('IndexState', () => {
  it('is idle and not in progress before any index run', () => {
    const state = new IndexState();
    expect(state.inProgress).toBe(false);
    expect(state.marker()).toBeUndefined();
    expect(state.snapshot()).toEqual({
      inProgress: false,
      phase: 'idle',
      filesDone: 0,
      filesTotal: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
      modelError: null,
    });
  });

  it('reports progress while a run is in flight', () => {
    const state = new IndexState();
    state.begin('loading-model', 1000);
    expect(state.inProgress).toBe(true);
    expect(state.snapshot()).toMatchObject({ inProgress: true, phase: 'loading-model', startedAt: 1000 });

    state.update({ phase: 'indexing', filesDone: 3, filesTotal: 10 });
    expect(state.snapshot()).toMatchObject({ inProgress: true, phase: 'indexing', filesDone: 3, filesTotal: 10 });
    expect(state.marker()).toEqual({ inProgress: true, filesDone: 3, filesTotal: 10 });
  });

  it('drops the marker and keeps the final counts once the run completes', () => {
    const state = new IndexState();
    state.begin('scanning', 1000);
    state.update({ phase: 'indexing', filesDone: 10, filesTotal: 10 });
    state.complete(4000);
    expect(state.inProgress).toBe(false);
    expect(state.marker()).toBeUndefined();
    expect(state.snapshot()).toMatchObject({
      inProgress: false,
      phase: 'ready',
      filesDone: 10,
      filesTotal: 10,
      finishedAt: 4000,
      error: null,
    });
  });

  it('records a failed run without staying in progress', () => {
    const state = new IndexState();
    state.begin('scanning', 1000);
    state.fail(new Error('disk on fire'), 2000);
    expect(state.inProgress).toBe(false);
    expect(state.marker()).toBeUndefined();
    expect(state.snapshot()).toMatchObject({ phase: 'failed', error: 'disk on fire', finishedAt: 2000 });
  });

  it('keeps a model load error separate from the index outcome', () => {
    const state = new IndexState();
    state.begin('loading-model', 1000);
    state.setModelError('offline');
    state.update({ phase: 'scanning', filesDone: 0, filesTotal: 0 });
    state.complete(2000);
    expect(state.snapshot()).toMatchObject({ phase: 'ready', error: null, modelError: 'offline' });
  });

  it('ignores progress reported after the run has ended', () => {
    const state = new IndexState();
    state.begin('scanning', 1000);
    state.fail('boom', 2000);
    state.update({ phase: 'indexing', filesDone: 1, filesTotal: 2 });
    expect(state.snapshot()).toMatchObject({ inProgress: false, phase: 'failed', filesDone: 0 });
  });

  it('clears the previous outcome when a new run begins', () => {
    const state = new IndexState();
    state.begin('scanning', 1000);
    state.update({ phase: 'indexing', filesDone: 5, filesTotal: 5 });
    state.fail('boom', 2000);
    state.begin('scanning', 3000);
    expect(state.snapshot()).toMatchObject({
      inProgress: true,
      phase: 'scanning',
      filesDone: 0,
      filesTotal: 0,
      startedAt: 3000,
      finishedAt: null,
      error: null,
    });
  });
});
