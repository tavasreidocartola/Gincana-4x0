# GINCANA 4x0 — versão online

A versão online mantém a interface do jogo e adiciona salas em tempo real, validação de placares no servidor e sincronização das fases.

## Rodar localmente

Requer Node.js 20 ou superior.

    npm install
    npm start

Abra http://localhost:10000 em duas ou mais janelas para testar. Sem REDIS_URL, as salas ficam em memória e são apagadas quando o servidor reinicia.

## Publicar no Render

O render.yaml configura um Web Service Node.js e um Render Key Value para compartilhar o estado das salas enquanto os recursos estão ativos. No plano gratuito, o Key Value não garante persistência após reinicializações.

1. No Render, escolha New → Blueprint.
2. Conecte tavasreidocartola/Gincana-4x0 na branch main.
3. Revise e confirme a criação dos recursos.
4. Abra a URL onrender.com gerada quando o deploy terminar.

O servidor usa a variável PORT, escuta em 0.0.0.0 e expõe /healthz. Publique como Web Service, não como Static Site, pois as salas precisam de um servidor Node ativo.

## Regras online

- Salas com até 16 participantes e código para convite.
- O elenco de cada participante é enviado e validado pelo servidor.
- O anfitrião só inicia quando todos os participantes da sala finalizaram os elencos.
- Se houver menos de 16 pessoas, times CPU completam as oitavas.
- Partidas de uma rodada podem ser simuladas em navegadores diferentes. Em confrontos entre pessoas, o servidor define quem confirma o resultado oficial.
- Resultados duplicados são recusados; empates exigem pênaltis com vencedor definido.
- A próxima fase só é criada depois que todos os confrontos da fase atual têm resultado confirmado.
- O estado de salas é compartilhado pelo Render Key Value quando REDIS_URL está configurada; no plano gratuito, uma reinicialização do Key Value pode apagar as salas. Para durabilidade, use um plano de armazenamento com persistência habilitada.
