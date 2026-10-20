import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent text-sm font-medium outline-none select-none transition-[scale,background-color,border-color,color,box-shadow,opacity] duration-160 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-soft inset-ring inset-ring-white/10 hover:bg-primary/90",
        outline: "border-border bg-background shadow-xs hover:border-foreground/15 hover:bg-muted hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-white shadow-soft hover:bg-destructive/90",
        success: "bg-emerald-600 text-white shadow-soft hover:bg-emerald-600/90",
        warning: "bg-amber-500 text-white shadow-soft hover:bg-amber-500/90",
        link: "text-primary underline-offset-4 active:scale-100 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        xs: "h-7 gap-1 rounded-lg px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 rounded-lg px-3 text-[0.8rem]",
        lg: "h-12 rounded-2xl px-6 text-base",
        xl: "h-14 rounded-2xl px-8 text-lg",
        icon: "size-10",
        "icon-sm": "size-9 rounded-lg",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renderiza el hijo (p. ej. <Link>) con los estilos del botón. */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, children, type, ...props }, ref) => {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, { ...props, className: cn(classes, child.props.className) } as Partial<unknown>);
  }
  return (
    <button ref={ref} data-slot="button" type={type ?? "button"} className={classes} {...props}>
      {children}
    </button>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
