import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:opacity-90',
      secondary: 'bg-muted text-foreground hover:bg-border',
      ghost: 'hover:bg-muted text-foreground',
      outline: 'border border-border bg-background hover:bg-muted',
      destructive: 'bg-destructive text-white hover:opacity-90',
    },
    size: { default: 'h-8 px-3 text-xs', sm: 'h-7 px-2.5 text-xs', icon: 'h-8 w-8' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />);
Button.displayName = 'Button';
