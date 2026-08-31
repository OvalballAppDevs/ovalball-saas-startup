import type { ComponentProps } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FormFieldProps extends ComponentProps<"input"> {
  label: string
  wrapperClassName?: string
}

export function FormField({
  label,
  id,
  wrapperClassName,
  className,
  ...props
}: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <Label htmlFor={id} className="text-ink/80">
        {label}
      </Label>
      <Input
        id={id}
        className={cn(
          "h-11 border-ink/15 bg-white px-3.5 text-base text-ink placeholder:text-ink/35",
          className
        )}
        {...props}
      />
    </div>
  )
}
