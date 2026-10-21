import * as React from 'react';
import { cn } from '../../lib/utils';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({className, ...props}, ref) => <input ref={ref} className={cn('h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-primary disabled:opacity-50', className)} {...props}/>);
Input.displayName = 'Input';
