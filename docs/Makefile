# Build the ESP32-S3 firmware sequence document.
#   make            -> esp32-firmware-sequence.pdf
#   make clean      -> remove build artefacts (keeps the PDF)
#   make distclean  -> also remove the PDF
TEX := esp32-firmware-sequence
LATEX := pdflatex
LATEXFLAGS := -interaction=nonstopmode -halt-on-error

$(TEX).pdf: $(TEX).tex
	$(LATEX) $(LATEXFLAGS) $(TEX).tex
	$(LATEX) $(LATEXFLAGS) $(TEX).tex   # second pass resolves references

.PHONY: clean distclean
clean:
	rm -f $(TEX).aux $(TEX).log $(TEX).out $(TEX).toc

distclean: clean
	rm -f $(TEX).pdf
