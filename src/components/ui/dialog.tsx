import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';
export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogClose = DialogPrimitive.Close;
export const DialogContent = ({children, className, overlayClassName}: {children: ReactNode; className?: string; overlayClassName?: string}) => <DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('fixed inset-0 z-40 bg-black/30',overlayClassName)}/><DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[410px] max-h-[calc(100vh-24px)] overflow-y-auto overscroll-contain -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-xl focus:outline-none',className)}>{children}</DialogPrimitive.Content></DialogPrimitive.Portal>;
