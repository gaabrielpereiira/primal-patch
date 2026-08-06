# Fotos de perfil + visual estilo WhatsApp no Chat

Duas frentes: trazer e guardar as fotos dos contatos do WhatsApp, e deixar a aba Chat com a cara do WhatsApp Web.

## Situação atual

As 68 conversas já sincronizadas têm nome, mas nenhuma tem foto (`avatar_url` vazio em todas). A sincronização só grava a foto se a Zernio devolver `participantPicture`, e nas conversas importadas esse campo veio vazio — por isso hoje aparecem só as iniciais.

## Fotos de perfil

- Buscar a foto em mais lugares durante a sincronização: no detalhe da conversa, no remetente das mensagens (`sender.picture`) e no evento do webhook — o primeiro que existir vence.
- Como as URLs de foto do WhatsApp expiram, a foto é baixada pela função de backend e guardada num bucket de armazenamento público (`whatsapp-avatars`), um arquivo por conversa. O app passa a exibir a cópia estável, que não quebra depois de algumas horas.
- Nova ação `refresh_avatars` na função `zernio-connect`, disparada pelo botão "Sincronizar" e também ao abrir uma conversa sem foto (no máximo uma tentativa por conversa por dia).
- Quando a conversa está vinculada a um paciente/contato que já tem `avatar_url` no cadastro, essa foto é usada como alternativa.
- Sem foto disponível, mantém-se a inicial — mas com cor de fundo derivada do nome, como no WhatsApp.

## Visual estilo WhatsApp

- **Lista de conversas**: linhas mais altas com separador só à direita do avatar, nome em cima, prévia da última mensagem embaixo com ícone de status (✓/✓✓) quando a última for enviada por nós, horário no canto e badge verde de não lidas.
- **Cabeçalho da conversa**: faixa com avatar, nome e telefone, no mesmo tom de fundo do cabeçalho da lista.
- **Área de mensagens**: papel de parede padrão do WhatsApp (padrão sutil, versões clara e escura), balões com "rabinho", verde para enviadas e branco/cinza para recebidas, horário + status dentro do balão, separadores de data em pílula centralizada.
- **Composer**: barra arredondada única com ícones de emoji e anexo (desabilitados nesta versão), campo que cresce até 6 linhas e botão redondo verde de enviar.
- **Estado vazio**: painel central no estilo "WhatsApp Web" com ilustração/ícone e texto explicativo.
- Cores em tokens semânticos novos (`--wa-bubble-out`, `--wa-bubble-in`, `--wa-panel`, `--wa-wallpaper`) definidos no CSS global, com variantes clara e escura — nada de cores fixas nos componentes.

## Detalhes técnicos

- Bucket público `whatsapp-avatars` criado via ferramenta de storage, com política de leitura pública e escrita apenas pelo backend.
- `supabase/functions/zernio-connect/index.ts`: nova ação `refresh_avatars` (baixa a imagem, faz upload no bucket, grava a URL pública em `whatsapp_conversations.avatar_url`); `sync_conversations` passa a usar a mesma rotina.
- `supabase/functions/zernio-webhook/index.ts`: ao receber foto nova no evento, também persiste a cópia no bucket.
- Frontend: ajustes em `ConversationList`, `MessageList`, `MessageComposer`, `Chat.tsx` e um novo `src/components/chat/Avatar` com cor determinística; tokens no `src/index.css` e `tailwind.config.ts`.

## Fora do escopo

- Envio de mídia, áudio e emojis (ícones ficam visíveis porém inativos).
- Fotos de grupos e status "digitando…".
