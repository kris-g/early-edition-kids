import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CostBars } from '../charts/Bars'
import { StoriesBarChart } from '../charts/StoriesBarChart'
import { TooltipProvider } from './TooltipProvider'

const days = [
  { date: '2026-11-09', issue: true, stories: 6, read: 0, minutes: 0 },
  { date: '2026-11-10', issue: true, stories: 6, read: 5, minutes: 9 },
  { date: '2026-11-11', issue: false, stories: 0, read: 0, minutes: 0 },
]

function renderBars() {
  return render(
    <TooltipProvider>
      <button type="button">before</button>
      <StoriesBarChart days={days} average={1.7} />
    </TooltipProvider>,
  )
}

describe('chart tooltips', () => {
  it('every bar carries its text as an accessible name', () => {
    renderBars()
    expect(screen.getByRole('img', { name: 'Mon 9 Nov · Not read' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Tue 10 Nov · 5 stories read · 9 min reading' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Wed 11 Nov · No paper' })).toBeInTheDocument()
  })

  it('keyboard focus shows the tooltip, arrows move it, Escape hides it', async () => {
    const user = userEvent.setup()
    renderBars()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab() // "before"
    await user.tab() // the chart's single tab stop: the latest day
    expect(screen.getByRole('tooltip')).toHaveTextContent('Wed 11 Nov · No paper')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tue 10 Nov · 5 stories read · 9 min reading')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('hover shows it and only one shows at a time', async () => {
    const user = userEvent.setup()
    renderBars()
    await user.hover(screen.getByRole('img', { name: 'Mon 9 Nov · Not read' }))
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Mon 9 Nov · Not read')
    await user.hover(screen.getByRole('img', { name: /Tue 10 Nov/ }))
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tue 10 Nov')
    await user.unhover(screen.getByRole('img', { name: /Tue 10 Nov/ }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('a tap shows it and a tap elsewhere hides it', () => {
    renderBars()
    const bar = screen.getByRole('img', { name: /Tue 10 Nov/ })
    act(() => {
      fireEvent.pointerDown(bar, { pointerType: 'touch' })
      fireEvent.pointerUp(bar, { pointerType: 'touch' })
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tue 10 Nov')
    act(() => {
      fireEvent.pointerDown(document.body, { pointerType: 'touch' })
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('a cost bar shows the date and cost', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <CostBars
          days={[
            { date: '2026-11-12', cost_usd: 0.47 },
            { date: '2026-11-13', cost_usd: 0.36 },
          ]}
          today="2026-11-13"
        />
      </TooltipProvider>,
    )
    await user.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fri 13 Nov · $0.36')
  })
})
