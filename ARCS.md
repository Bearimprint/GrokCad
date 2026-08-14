Pour les ARCS il nous faut plsieurs commandes.
 - /arcc: (Arc depuis le Centre ou /ARCC) Cette commande crée un arc où le premier clic défini le centre de l'arc ensuite l'arc (un cercle en fait) suit le mouvement de la souris jusqu'au prochain clic qui definit le rayon. Un fois fait si on veut garder le cercle, on appuie sur la touche [ESC] ou [Echap] (sur le clavier français) et si on ne le fait pas, le prochain clic indiquera le point de départ du cerlce et le second clic, sa fin (à voir s'il est possible d'avoi l'arc qui suis la souris aprés que l'on ai cliqué sur le point de départ de l'arc)

- /arc: Premier clic defini le point de départ de l'arc, le deuxiéme un point de passage/ancrage obligé et le troisiéme la fin de l'arc (idem que pour les autres, il faudrait que l'arc soit déssiné en temps réel et s'adpate au diferent clic jusqu'à arriver au dernier ou il se dessine definitivement en tant qu'élément du dessin

- /arccont: (Arcs continus) Celle là est la plus complexe, elle dessine des arcs qui se suivent sans aucune "cassure". Si le premier clic est fait dans le vide, on contuit un premier arc comme s'il s'agissait de la commande "/arc" et ensuite l'arc suivant se dessine en s'adaptant en temps réel en suivant la souris pour que le point final du premier arc et le prochain arc qui va se dessiner n'ai pas d'angle brisé. Il dois être dans la continuité "suave/logique" de la'rc précédent. Si jamais la souris de déplace à une position qui ne permet pas d'avoir un arc "smooth", le dessin en dynamique de l'arc disparait jusqu'a que la souris revienne à une position qui permet d'avoi un arc correctement racroché au précédent. J'espère que c'est assez clair parce que, autant c'est évident dans ma tête, autant pour l'expliquer correctement c'est compliqué vu que je n'ai plus le nom exact lorsque deux arc se suivent sans qu'il n'y ai de "cassure" entre les deux mais une continuité parfaite.

/cercle: Le plus simple, premier clic definit le centre et le deuxiéme le rayon. et on dessine l'élément cercle dans le canvas.

---

## Implémentation (v0.5)

Spéc validée et codée :
- `/arcc` · `/arc` · `/arccont` · `/cercle`
- Entité `circle` dans le `.GKD`
- Continuité `/arccont` = tangente G1
- `/arcc` + **Échap** après le rayon = commit cercle
- Preview dynamique `/arc` corrigé (recreate `Line2` si nb segments change)

> **Suite hors ARCS** : `/cut` (v0.6) — voir `STATUS.md` / `README.md`.

