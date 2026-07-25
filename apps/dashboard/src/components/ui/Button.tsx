import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center gap-1.5 text-[12.5px] font-560 tracking-[-.005em] rounded-md disabled:opacity-60 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "h-[31px] pl-2.5 pr-[13px] bg-acc text-white hover:brightness-[1.08]",
        secondary: "h-[31px] px-3 bg-sf border border-ln text-t1 hover:border-accL hover:bg-sf2",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export default function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "w-[30px] h-[30px] flex items-center justify-center rounded-sm text-t2 hover:bg-sf2 disabled:opacity-60 disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}
