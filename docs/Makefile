# Build the unified ESP32-S3 IoT Platform specification (Parts I-III).
#   make            -> esp32-platform-spec.pdf
#   make clean      -> remove build artefacts (keeps the PDF)
#   make distclean  -> also remove the PDF
TEX := esp32-platform-spec
PARTS := esp32-platform-parts.tex
LATEX := pdflatex
LATEXFLAGS := -interaction=nonstopmode -halt-on-error

$(TEX).pdf: $(TEX).tex $(PARTS)
	$(LATEX) $(LATEXFLAGS) $(TEX).tex
	$(LATEX) $(LATEXFLAGS) $(TEX).tex   # second pass resolves the table of contents

.PHONY: clean distclean
clean:
	rm -f $(TEX).aux $(TEX).log $(TEX).out $(TEX).toc

distclean: clean
	rm -f $(TEX).pdf
