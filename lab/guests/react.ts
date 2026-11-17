import './react-environment'
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { GuestContext } from '@inflowenger/plugin-sandbox/guest'

/**
 * The React half of the renderer-smoke plugin. Written with createElement so
 * the guest exercises the same Remote DOM surface a JSX build would, without
 * needing a second JSX transform configuration.
 *
 * React renders the tree, but events deliberately use the guest DOM's
 * `addEventListener` channel rather than React synthetic events: a host Event
 * cannot be reconstructed inside the Worker, while Remote DOM's event bridge
 * already provides the described value a form listener needs.
 */
type DescribedInputEvent = { target: { value: string } }
type RemoteElement = {
  addEventListener(type: string, listener: (event: never) => void): void
  removeEventListener(type: string, listener: (event: never) => void): void
}

function Guest({ ctx }: { ctx: GuestContext }): ReactElement {
  const [message, setMessage] = useState(String((ctx.data as any)?.message ?? ''))
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<RemoteElement | null>(null)
  const button = useRef<RemoteElement | null>(null)
  const messageRef = useRef(message)
  messageRef.current = message

  useEffect(() => {
    return ctx.onData((next) => {
      setMessage(String((next as any)?.message ?? ''))
    })
  }, [ctx])

  useEffect(() => {
    const inputElement = input.current
    const buttonElement = button.current
    if (!inputElement || !buttonElement) return

    const update = (event: DescribedInputEvent) => {
      setMessage(event.target.value)
      ctx.patchData({ message: event.target.value })
    }
    const describe = async () => {
      setBusy(true)
      try {
        const response: any = await ctx.call('renderer.meta.describe.react', {
          message: messageRef.current,
        })
        const text = String(response?.message ?? '')
        setResult(text)
        ctx.notify({ severity: 'success', message: text })
      } catch (error) {
        const text = String(error)
        setResult(text)
        ctx.notify({ severity: 'error', message: text })
      } finally {
        setBusy(false)
      }
    }

    inputElement.addEventListener('input', update as never)
    buttonElement.addEventListener('click', describe as never)
    return () => {
      inputElement.removeEventListener('input', update as never)
      buttonElement.removeEventListener('click', describe as never)
    }
  }, [ctx])

  return createElement(
    'section',
    { className: 'if-vstack', 'data-renderer-smoke': 'react' },
    createElement('p', { className: 'if-desc' }, 'A React component running in the renderer-smoke plugin.'),
    createElement(
      'div',
      { className: 'if-control' },
      createElement('label', { className: 'if-label', htmlFor: 'renderer-react-message' }, 'Message from React'),
      createElement('input', {
        id: 'renderer-react-message',
        ref: input,
        className: 'if-input',
        type: 'text',
        value: message,
        disabled: ctx.readonly,
        'data-renderer-smoke-input': 'message',
      }),
    ),
    createElement(
      'button',
      {
        ref: button,
        className: 'if-btn',
        type: 'button',
        style: { alignSelf: 'flex-start' },
        disabled: busy || ctx.readonly,
        'data-renderer-smoke-call': 'describe-react',
      },
      busy ? 'Calling plugin…' : 'Call React plugin meta method',
    ),
    createElement('p', { 'data-renderer-smoke-result': 'meta-react' }, result),
  )
}

export default function mount(ctx: GuestContext) {
  const root = createRoot(ctx.root as unknown as Element)
  root.render(createElement(Guest, { ctx }))
  return () => root.unmount()
}
