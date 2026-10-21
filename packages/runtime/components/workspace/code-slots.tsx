import { Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react'

/** Highlight styles are shared across snippets and must outlive the selected code view. */
export function collectCodeSlots(children: ReactNode) {
  const styles: ReactNode[] = []
  const blocks = new Map<string, ReactNode>()
  const visuals = new Map<string, ReactNode>()
  const stripStyles = (node: ReactNode): ReactNode => {
    if (!isValidElement(node)) return node
    if (node.type === 'style') {
      styles.push(cloneElement(node, { key: `code-style-${styles.length}` }))
      return null
    }
    const element = node as ReactElement<{ children?: ReactNode }>
    if (element.props.children === undefined) return element
    return cloneElement(element, { children: Children.map(element.props.children, stripStyles) })
  }
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue
    const props = child.props as {
      'data-workspace-code'?: string
      'data-workspace-visual'?: string
      children?: ReactNode
    }
    if (props['data-workspace-code'])
      blocks.set(props['data-workspace-code'], Children.map(props.children, stripStyles))
    if (props['data-workspace-visual'])
      visuals.set(props['data-workspace-visual'], stripStyles(child))
  }
  return { blocks, styles, visuals }
}
