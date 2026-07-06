import { useState } from "react"
import type { DotMatrixCommonProps } from "@/lib/dotmatrix-core"
import { DotmSquare2 } from "@/components/ui/dotm-square-2"
import { DotmSquare3 } from "@/components/ui/dotm-square-3"
import { DotmSquare4 } from "@/components/ui/dotm-square-4"
import { DotmSquare5 } from "@/components/ui/dotm-square-5"
import { DotmSquare6 } from "@/components/ui/dotm-square-6"
import { DotmSquare16 } from "@/components/ui/dotm-square-16"
import { DotmSquare17 } from "@/components/ui/dotm-square-17"
import { DotmSquare18 } from "@/components/ui/dotm-square-18"
import { DotmSquare19 } from "@/components/ui/dotm-square-19"
import { DotmSquare20 } from "@/components/ui/dotm-square-20"

// Loaders from dotmatrix (github.com/zzzzshawn/matrix): Pulse Ladder, Core
// Spiral, Twin Orbit, Prism Sweep, Flux Columns, Helix Core, Half Helix,
// Sound Bars, Infinity Run, Mobius Run.
const LOADERS = [
  DotmSquare2,
  DotmSquare3,
  DotmSquare4,
  DotmSquare5,
  DotmSquare6,
  DotmSquare16,
  DotmSquare17,
  DotmSquare18,
  DotmSquare19,
  DotmSquare20,
]

let rotation = 0

// Each mounted loader takes the next animation in the rotation and keeps it
// for its lifetime, so concurrent loaders vary instead of all looking alike.
export function DotMatrixLoader(props: DotMatrixCommonProps) {
  const [Loader] = useState(() => LOADERS[rotation++ % LOADERS.length])
  return <Loader {...props} />
}
