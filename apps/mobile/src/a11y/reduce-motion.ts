import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

/** The person's Reduce Motion setting, live. Motion is reduced; state is never hidden. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (live) setReduce(v) })
      .catch(() => undefined)
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce)
    return () => {
      live = false
      sub.remove()
    }
  }, [])
  return reduce
}
