import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-[hsl(200_60%_45%)]",
  "bg-[hsl(160_50%_38%)]",
  "bg-[hsl(20_70%_50%)]",
  "bg-[hsl(280_40%_50%)]",
  "bg-[hsl(340_55%_50%)]",
  "bg-[hsl(45_65%_45%)]",
  "bg-[hsl(220_50%_52%)]",
  "bg-[hsl(120_35%_40%)]",
];

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface Props {
  name: string;
  src?: string | null;
  className?: string;
}

/** WhatsApp-style avatar: photo when available, otherwise coloured initials. */
export function WaAvatar({ name, src, className }: Props) {
  const letters = name.replace(/[^\p{L}]/gu, "");
  const initials = letters
    ? name
        .split(/\s+/)
        .filter((w) => /\p{L}/u.test(w))
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : null;

  return (
    <Avatar className={cn("h-12 w-12 shrink-0", className)}>
      {src ? <AvatarImage src={src} alt={`Foto de ${name}`} loading="lazy" /> : null}
      <AvatarFallback
        className={cn(
          initials ? PALETTE[hash(name) % PALETTE.length] : "bg-wa-divider",
          "font-medium",
          initials ? "text-[hsl(0_0%_100%)]" : "text-wa-meta",
        )}
      >
        {initials ?? <User className="h-1/2 w-1/2" />}
      </AvatarFallback>
    </Avatar>
  );
}

