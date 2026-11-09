// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectBoard } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import type { Platform } from '../platform/platform.js';
import { useCore } from './use-core.js';
test('undoing a reviewed command removes only its event from the session undo stack', async () => {
  const state = JSON.parse(readFileSync('fixtures/states/portfolio.state.json','utf8')).state as WorkspaceState;
  const execute = vi.fn().mockResolvedValueOnce({ok:true,eventId:'first'}).mockResolvedValue({ok:true,eventId:'undo'});
  const transport = { query: vi.fn().mockResolvedValue(projectBoard(state,[],{now:'2026-11-09T14:00:00Z'})), execute, applyCommandPlan: vi.fn().mockResolvedValue({ok:true,eventId:'plan'}), subscribe: vi.fn().mockResolvedValue(()=>{}), close: vi.fn() };
  const platform = {connectCore:vi.fn().mockResolvedValue(transport)} as unknown as Platform;
  const view = renderHook(()=>useCore(platform)); await waitFor(()=>expect(view.result.current.state.phase).toBe('connected'));
  await act(async()=>{ await view.result.current.execute({name:'node.update',args:{id:'synthetic',patch:{title:'Synthetic'}}}); });
  await act(async()=>{ await view.result.current.applyCommandPlan('synthetic-plan'); });
  await act(async()=>{ await view.result.current.execute({name:'change.undo',args:{eventId:'plan'}}); });
  await act(async()=>{ await view.result.current.undo(); });
  expect(execute.mock.calls.at(-1)![0]).toEqual({name:'change.undo',args:{eventId:'first'}}); view.unmount();
});
