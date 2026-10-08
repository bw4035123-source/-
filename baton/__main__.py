"""python -m baton 으로도 실행할 수 있게 한다."""
import os
import runpy

runpy.run_path(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "run.py"), run_name="__main__")
