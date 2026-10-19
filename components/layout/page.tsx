import { cn } from "@/lib/utils";

/** Pembungkus konten halaman biasa (padding menyesuaikan bottom nav di mobile). */
export function Page({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            className={cn("flex flex-col gap-5 px-4 pt-5 pb-safe-nav lg:px-7 lg:pt-6 lg:pb-8", className)}
            {...props}
        />
    );
}
