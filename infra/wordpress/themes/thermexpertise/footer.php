<?php
/**
 * Site footer.
 *
 * @package thermexpertise
 */

$thex = thex_company();
?>
</main><!-- #main -->

<footer class="site-footer">
	<div class="container">
		<div class="footer-grid">
			<div class="footer-brand">
				<div class="brand">
					<span class="brand__mark">TX</span>
					<span><span class="brand__name">THERM EXPERTISE</span></span>
				</div>
				<p><?php esc_html_e( 'Professional consultant engineers delivering steam, energy, IoT and MEP solutions across Thailand and Southeast Asia.', 'thermexpertise' ); ?></p>
				<div class="social">
					<a href="<?php echo esc_url( $thex['facebook'] ); ?>" target="_blank" rel="noopener" aria-label="Facebook">
						<?php echo thex_icon( 'fb' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					</a>
					<a href="mailto:<?php echo esc_attr( $thex['email'] ); ?>" aria-label="Email">
						<?php echo thex_icon( 'mail' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					</a>
					<a href="tel:<?php echo esc_attr( $thex['phone_raw'] ); ?>" aria-label="Phone">
						<?php echo thex_icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					</a>
				</div>
			</div>

			<div>
				<h4><?php esc_html_e( 'Company', 'thermexpertise' ); ?></h4>
				<ul>
					<li><a href="<?php echo esc_url( home_url( '/about/' ) ); ?>"><?php esc_html_e( 'About Us', 'thermexpertise' ); ?></a></li>
					<li><a href="<?php echo esc_url( home_url( '/services/' ) ); ?>"><?php esc_html_e( 'Services', 'thermexpertise' ); ?></a></li>
					<li><a href="<?php echo esc_url( home_url( '/products/' ) ); ?>"><?php esc_html_e( 'Products', 'thermexpertise' ); ?></a></li>
					<li><a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Contact', 'thermexpertise' ); ?></a></li>
				</ul>
			</div>

			<div>
				<h4><?php esc_html_e( 'Services', 'thermexpertise' ); ?></h4>
				<ul>
					<li><?php esc_html_e( 'Steam & Compressed Air', 'thermexpertise' ); ?></li>
					<li><?php esc_html_e( 'Energy Management', 'thermexpertise' ); ?></li>
					<li><?php esc_html_e( 'IoT for Smart Industrial', 'thermexpertise' ); ?></li>
					<li><?php esc_html_e( 'MEP System', 'thermexpertise' ); ?></li>
					<li><?php esc_html_e( 'Training Courses', 'thermexpertise' ); ?></li>
				</ul>
			</div>

			<div>
				<h4><?php esc_html_e( 'Get in Touch', 'thermexpertise' ); ?></h4>
				<ul>
					<li><?php echo esc_html( $thex['address'] ); ?></li>
					<li><a href="tel:<?php echo esc_attr( $thex['phone_raw'] ); ?>"><?php echo esc_html( $thex['phone'] ); ?></a></li>
					<li><a href="mailto:<?php echo esc_attr( $thex['email'] ); ?>"><?php echo esc_html( $thex['email'] ); ?></a></li>
					<li><?php esc_html_e( 'Service Area:', 'thermexpertise' ); ?> <?php echo esc_html( $thex['area'] ); ?></li>
				</ul>
			</div>
		</div>

		<div class="footer-bottom">
			<span>&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php echo esc_html( $thex['name'] ); ?> <?php esc_html_e( 'All rights reserved.', 'thermexpertise' ); ?></span>
			<span><?php esc_html_e( 'Built with WordPress', 'thermexpertise' ); ?></span>
		</div>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
