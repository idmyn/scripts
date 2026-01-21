FROM debian:bookworm-slim

ARG TZ
ENV TZ="$TZ"

# System tools
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl less git ripgrep jq fd-find unzip \
  ncurses-term locales \
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Terminal environment
ENV TERM=xterm-256color
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Create agentbox user
RUN groupadd -r agentbox && useradd -r -g agentbox agentbox
RUN mkdir -p /workspace /home/agentbox /home/agentbox-template && \
  chown -R agentbox:agentbox /workspace /home/agentbox /home/agentbox-template

# Entrypoint to preserve $HOME content
RUN printf '#!/bin/bash\nif [ -z "$(ls -A /home/agentbox 2>/dev/null)" ]; then\n  cp -a /home/agentbox-template/. /home/agentbox/\nfi\nexec "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

# Install mise and claude as agentbox user
USER agentbox
ENV HOME=/home/agentbox-template
RUN curl https://mise.run | sh
RUN echo 'eval "$(~/.local/bin/mise activate --shims bash)"' >> ~/.bashrc
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN ~/.local/bin/mise use -g bun@latest

ENV HOME=/home/agentbox
ENV PATH="/home/agentbox/.local/share/mise/shims:/home/agentbox/.local/bin:$PATH"
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
