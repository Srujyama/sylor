import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary = inverted fill (btn-primary style)
        default:
          "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] border border-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] hover:border-[var(--btn-primary-hover)]",
        // Ghost = transparent, dim border
        ghost:
          "bg-transparent text-[var(--btn-ghost-text)] border border-[var(--btn-ghost-border)] hover:bg-[var(--btn-ghost-hover-bg)] hover:text-[var(--page-text)]",
        // Destructive
        destructive:
          "bg-red-500 text-white border border-red-500 hover:bg-red-400",
        // Outline — alias for ghost
        outline:
          "bg-transparent text-[var(--btn-ghost-text)] border border-[var(--btn-ghost-border)] hover:bg-[var(--btn-ghost-hover-bg)] hover:text-[var(--page-text)]",
        secondary:
          "bg-[var(--tag-bg)] text-[var(--tag-text)] border border-[var(--tag-border)] hover:bg-[var(--sidebar-active-bg)]",
        link: "text-[var(--btn-ghost-text)] underline-offset-4 hover:underline hover:text-[var(--page-text)]",
        // Legacy aliases — map to sensible equivalents
        gradient:
          "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] border border-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] hover:border-[var(--btn-primary-hover)]",
        glass:
          "bg-transparent text-[var(--btn-ghost-text)] border border-[var(--btn-ghost-border)] hover:bg-[var(--btn-ghost-hover-bg)] hover:text-[var(--page-text)]",
      },
      size: {
        default: "h-9 px-4 py-2 text-xs",
        sm: "h-8 px-3 py-1.5 text-xs",
        lg: "h-10 px-6 py-2.5 text-sm",
        xl: "h-11 px-8 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
