import type { ComponentProps } from "react"
import { ChevronDown } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FormSelectProps extends ComponentProps<"select"> {
  label: string
  wrapperClassName?: string
}

export function FormSelect({
  label,
  id,
  wrapperClassName,
  className,
  children,
  ...props
}: FormSelectProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <Label htmlFor={id} className="text-ink/80">
        {label}
      </Label>
      <div className="relative">
        <select
          id={id}
          className={cn(
            "h-11 w-full appearance-none rounded-lg border border-ink/15 bg-white px-3.5 pr-9 text-base text-ink outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink/40" />
      </div>
    </div>
  )
}
