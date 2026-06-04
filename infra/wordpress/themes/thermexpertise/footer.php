<?php
/**
 * Footer template.
 *
 * @package ThermExpertise
 */
?>
</main><!-- #content -->

<footer class="site-footer">
	<div class="container site-footer__grid">
		<div class="site-footer__brand">
			<span class="site-title__mark">THEX</span>
			<p class="site-footer__name"><?php bloginfo( 'name' ); ?></p>
			<p class="site-footer__tagline"><?php bloginfo( 'description' ); ?></p>
		</div>

		<nav class="site-footer__nav" aria-label="<?php esc_attr_e( 'Footer', 'thermexpertise' ); ?>">
			<?php
			wp_nav_menu( array(
				'theme_location' => 'footer',
				'container'      => false,
				'menu_class'     => 'site-footer__list',
				'fallback_cb'    => false,
				'depth'          => 1,
			) );
			?>
		</nav>

		<div class="site-footer__contact">
			<h4><?php esc_html_e( 'Contact', 'thermexpertise' ); ?></h4>
			<?php if ( $p = thex_contact( 'thex_phone' ) ) : ?>
				<p><a href="tel:<?php echo esc_attr( preg_replace( '/\s+/', '', $p ) ); ?>"><?php echo esc_html( $p ); ?></a></p>
			<?php endif; ?>
			<?php if ( $e = thex_contact( 'thex_email' ) ) : ?>
				<p><a href="mailto:<?php echo esc_attr( $e ); ?>"><?php echo esc_html( $e ); ?></a></p>
			<?php endif; ?>
			<?php if ( $a = thex_contact( 'thex_address' ) ) : ?>
				<p><?php echo esc_html( $a ); ?></p>
			<?php endif; ?>
		</div>
	</div>

	<div class="site-footer__bar">
		<div class="container">
			<p>&copy; <?php echo esc_html( date_i18n( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>. <?php esc_html_e( 'All rights reserved.', 'thermexpertise' ); ?></p>
		</div>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
