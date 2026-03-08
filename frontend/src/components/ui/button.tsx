import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary = white fill, black text (btn-primary style)
        default:
          "bg-[#ededed] text-[#0a0a0a] border border-[#ededed] hover:bg-white hover:border-white",
        // Ghost = transparent, dim border
        ghost:
          "bg-transparent text-white/60 border border-white/10 hover:bg-white/[0.04] hover:text-white/90 hover:border-white/18",
        // Destructive
        destructive:
          "bg-red-500 text-white border border-red-500 hover:bg-red-400",
        // Outline — alias for ghost
        outline:
          "bg-transparent text-white/60 border border-white/10 hover:bg-white/[0.04] hover:text-white/90",
        secondary:
          "bg-white/[0.06] text-white/70 border border-white/10 hover:bg-white/[0.10]",
        link: "text-white/60 underline-offset-4 hover:underline hover:text-white/90",
        // Legacy aliases — map to sensible equivalents
        gradient:
          "bg-[#ededed] text-[#0a0a0a] border border-[#ededed] hover:bg-white hover:border-white",
        glass:
          "bg-transparent text-white/60 border border-white/10 hover:bg-white/[0.04] hover:text-white/90 hover:border-white/18",
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
