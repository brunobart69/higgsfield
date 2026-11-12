import sys

from .cli import main

if __name__ == "__main__":   # proteção necessária no Windows (processos filhos importam este módulo)
    sys.exit(main())
