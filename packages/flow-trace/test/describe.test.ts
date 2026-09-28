import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeEvent } from '../src/index.js'
import type { ErrorLogFields, ProcEvent, StopOnErrorFields } from '../src/index.js'

function logEvent<D>(detail: D, level: 'warn' | 'error' = 'error'): ProcEvent<D> {
  return { v: 1, pid: 'p', seq: 1, ts: 0, kind: 'log', level, src: 'rt', flow: 'f1', node: 'n7', detail }
}

// A branch that ended by decision rather than by reaching its last node. The line
// has to name the cause: it is read out of a filter as often as next to the error
// that caused it.
test('describes a branch cut by stop_on_error', () => {
  const detail: StopOnErrorFields & { msg: string } = {
    category: 'stop.on.error',
    pruned: 2,
    code: 24,
    cause: 'error running js code: boom',
    msg: 'stop on error: 2 outgoing edge(s) pruned',
  }

  const line = describeEvent(logEvent(detail, 'warn'))

  assert.match(line, /2 outgoing edge\(s\) pruned/)
  assert.match(line, /error running js code: boom/)
})

// An error the run recorded carries whose it was. A consumer that cannot tell a
// node error from a platform one sends flow authors after outages they cannot fix.
test('an error the run recorded carries its kind and code', () => {
  const nodeErr: ErrorLogFields = { msg: 'error running js code: boom', code: 24, kind: 'node' }
  const systemErr: ErrorLogFields = { msg: 'infra connection error', code: 16, kind: 'system' }

  assert.equal(describeEvent(logEvent(nodeErr)), 'error running js code: boom')
  assert.equal(describeEvent(logEvent(systemErr)), 'infra connection error')
  assert.equal(nodeErr.kind, 'node')
  assert.equal(systemErr.kind, 'system')
})

// An error-level log that is not one of the run's errors carries neither field,
// and must not be read as one.
test('a loud diagnostic is not one of the run errors', () => {
  const line = describeEvent(logEvent({ msg: 'Unknown command: foo/bar' }))
  assert.equal(line, 'Unknown command: foo/bar')
})
