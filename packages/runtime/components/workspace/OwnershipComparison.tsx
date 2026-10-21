import type { WorkspaceDecision } from './model.js'
import { reviewAnchor } from './feedback.js'
import './ownership-comparison.css'
import { changeMark, useRevisionChanges } from './RevisionChanges.js'
import { changeKey } from './revision-diff.js'

export function OwnershipComparison({ decision }: { decision: WorkspaceDecision }) {
  const revision = useRevisionChanges()
  if (!decision.ownership.length) return null
  const hasRemovals = decision.ownership.some(row => row.removed.length > 0)
  return (
    <section
      className='vp-ownership'
      aria-label='Ownership comparison'
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the table on narrow screens.
      tabIndex={0}
      {...reviewAnchor('ownership', 'Ownership changes')}
    >
      <table>
        <caption>Ownership changes</caption>
        <thead>
          <tr>
            <th scope='col'>Area</th>
            <th scope='col'>Current</th>
            <th scope='col'>Proposed</th>
            {hasRemovals ? <th scope='col'>Can delete</th> : null}
          </tr>
        </thead>
        <tbody>
          {decision.ownership.map(row => (
            <tr
              key={row.id}
              {...reviewAnchor(`ownership:${row.id}`, row.area)}
              {...changeMark(revision, changeKey('decision', decision.id, 'ownership', row.id))}
            >
              <th scope='row'>{row.area}</th>
              <td {...reviewAnchor('current-owner', 'Current owner')}>
                <code>{row.current}</code>
              </td>
              <td {...reviewAnchor('proposed-owner', 'Proposed owner')}>
                <code>{row.proposed}</code>
              </td>
              {hasRemovals ? (
                <td {...reviewAnchor('removed', 'Code to delete')}>
                  {row.removed.length ? (
                    <ul>
                      {row.removed.map(item => (
                        <li key={item}>
                          <code>{item}</code>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
