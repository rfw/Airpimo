import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({className, ...props}, ref) => <SwitchPrimitive.Root ref={ref} className={cn('relative h-5 w-9 cursor-pointer rounded-full bg-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=checked]:bg-primary',className)} {...props}><SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]"/></SwitchPrimitive.Root>);
Switch.displayName = 'Switch';
