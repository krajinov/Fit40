import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Fit40 button variants (locked design).
 *
 * - default   → Button/Primary:  deep green, h52, radius 12, Inter 16/600
 * - secondary → Button/Secondary: surface + border-strong, h52, radius 12
 * - outline   → same treatment as secondary (kept for compatibility)
 * - ghost     → Button/Ghost:    transparent, h44, radius 10, Inter 15/500
 *
 * Touch targets follow the design: 52px primary/secondary, 44px ghost/icon.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-control bg-primary font-semibold text-primary-foreground hover:bg-accent-strong",
        secondary:
          "rounded-control border-border-strong bg-card font-semibold text-foreground hover:bg-surface-2",
        outline:
          "rounded-control border-border-strong bg-card font-semibold text-foreground hover:bg-surface-2",
        ghost:
          "rounded-lg font-medium text-ink-2 hover:bg-surface-2 hover:text-foreground",
        destructive:
          "rounded-control bg-destructive/10 font-semibold text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "font-medium text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[52px] gap-2 px-7 text-base has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6",
        sm: "h-11 gap-2 rounded-[0.625rem] px-4 text-[15px] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-[52px] gap-2 px-8 text-base has-data-[icon=inline-end]:pr-7 has-data-[icon=inline-start]:pl-7",
        icon: "size-11 rounded-control",
        "icon-sm": "size-11 rounded-[0.625rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
