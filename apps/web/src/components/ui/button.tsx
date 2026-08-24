import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-text-inverse shadow-sm hover:bg-primary-hover",
        destructive: "bg-error text-text-inverse shadow-sm hover:bg-error/90",
        outline:
          "border border-border bg-surface shadow-sm hover:bg-surface-raised hover:text-text",
        secondary: "bg-surface-raised text-text shadow-sm hover:bg-border",
        ghost: "hover:bg-surface-raised hover:text-text",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-md py-sm",
        sm: "h-8 rounded-md px-sm text-xs",
        lg: "h-10 rounded-md px-lg",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        type="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
